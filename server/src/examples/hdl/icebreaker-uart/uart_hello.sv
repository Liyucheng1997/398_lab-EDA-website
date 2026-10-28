`timescale 1ns / 1ps

// iCEBreaker 串口问候：上电后立即、之后每秒通过 FTDI 串口发送一次 "Hello, WebEDA!\r\n"。
//   · 按下 BTN_N 立即再发送一次；
//   · 发送期间绿灯点亮。
// 在电脑上用串口终端（115200 8N1）打开 iCEBreaker 的第二个 FTDI 端口即可看到输出。
module uart_hello #(
  parameter CLK_HZ = 12_000_000,  // 输入时钟频率（Hz）
  parameter BAUD   = 115_200      // 波特率
) (
  input  logic clk,
  input  logic btn_n,             // 按下为 0
  output logic tx,                // 接 FTDI RX
  output logic led_g_n            // 低电平点亮
);
  localparam CLKS_PER_BIT = (CLK_HZ / BAUD > 1) ? CLK_HZ / BAUD : 2;
  localparam MSG_LEN      = 16;
  localparam WAIT_W       = $clog2(CLK_HZ + 1);

  // 消息 ROM
  function automatic logic [7:0] msg_char(input logic [3:0] i);
    case (i)
      4'd0:    msg_char = "H";
      4'd1:    msg_char = "e";
      4'd2:    msg_char = "l";
      4'd3:    msg_char = "l";
      4'd4:    msg_char = "o";
      4'd5:    msg_char = ",";
      4'd6:    msg_char = " ";
      4'd7:    msg_char = "W";
      4'd8:    msg_char = "e";
      4'd9:    msg_char = "b";
      4'd10:   msg_char = "E";
      4'd11:   msg_char = "D";
      4'd12:   msg_char = "A";
      4'd13:   msg_char = "!";
      4'd14:   msg_char = 8'h0D;  // \r
      default: msg_char = 8'h0A;  // \n
    endcase
  endfunction

  // 上电复位：配置完成后保持 15 个周期的复位
  logic [3:0] por_cnt = '0;
  logic       rst;
  always_ff @(posedge clk) if (rst) por_cnt <= por_cnt + 4'd1;
  assign rst = ~&por_cnt;

  // 按键同步 + 下降沿（按下）检测
  logic btn_s0 = 1'b1, btn_s = 1'b1, btn_prev = 1'b1;
  logic pressed;
  always_ff @(posedge clk) begin
    btn_s0   <= btn_n;
    btn_s    <= btn_s0;
    btn_prev <= btn_s;
  end
  assign pressed = btn_prev & ~btn_s;

  // 发送状态机
  typedef enum logic [1:0] {S_IDLE = 2'd0, S_SEND = 2'd1, S_HOLD = 2'd2, S_NEXT = 2'd3} state_t;

  state_t            state;
  logic [3:0]        idx;
  logic [WAIT_W-1:0] wait_cnt;
  logic              start;
  logic [7:0]        data;
  logic              busy;

  always_ff @(posedge clk) begin
    if (rst) begin
      state    <= S_SEND;   // 复位后立即发送一次
      idx      <= '0;
      wait_cnt <= '0;
      start    <= 1'b0;
      data     <= '0;
    end else begin
      case (state)
        S_IDLE: begin
          if (pressed || wait_cnt == WAIT_W'(CLK_HZ - 1)) begin
            wait_cnt <= '0;
            idx      <= '0;
            state    <= S_SEND;
          end else begin
            wait_cnt <= wait_cnt + 1'b1;
          end
        end
        S_SEND: if (!busy) begin
          data  <= msg_char(idx);
          start <= 1'b1;
          state <= S_HOLD;
        end
        S_HOLD: begin             // uart_tx 在这一拍采样到 start
          start <= 1'b0;
          state <= S_NEXT;
        end
        default: if (!busy) begin // S_NEXT：等这个字节发完
          if (idx == 4'(MSG_LEN - 1)) begin
            state <= S_IDLE;
          end else begin
            idx   <= idx + 4'd1;
            state <= S_SEND;
          end
        end
      endcase
    end
  end

  uart_tx #(.CLKS_PER_BIT(CLKS_PER_BIT)) u_tx (
    .clk(clk), .rst(rst), .start(start), .data(data), .tx(tx), .busy(busy)
  );

  assign led_g_n = (state == S_IDLE);  // 发送期间点亮
endmodule
