`timescale 1ns / 1ps

// UART 收发器（8N1：1 个起始位、8 个数据位 LSB 先发、无校验、1 个停止位）
//   CLKS_PER_BIT = 时钟频率 / 波特率，例如 12 MHz / 115200 ≈ 104。

module uart_tx #(
  parameter CLKS_PER_BIT = 16
) (
  input  logic       clk,
  input  logic       rst,
  input  logic       start,   // 单拍启动（busy 为 0 时有效）
  input  logic [7:0] data,
  output logic       tx,      // 空闲为高
  output logic       busy
);
  localparam CW = $clog2(CLKS_PER_BIT);

  logic [CW-1:0] clk_cnt;
  logic [3:0]    bit_idx;     // 0 = 起始位，1~8 = 数据位，9 = 停止位
  logic [9:0]    frame;       // {停止位, 数据, 起始位}

  always_ff @(posedge clk) begin
    if (rst) begin
      busy    <= 1'b0;
      tx      <= 1'b1;
      clk_cnt <= '0;
      bit_idx <= '0;
      frame   <= '1;
    end else if (!busy) begin
      tx <= 1'b1;
      if (start) begin
        frame   <= {1'b1, data, 1'b0};
        busy    <= 1'b1;
        clk_cnt <= '0;
        bit_idx <= '0;
        tx      <= 1'b0;          // 立即输出起始位
      end
    end else if (clk_cnt == CW'(CLKS_PER_BIT - 1)) begin
      clk_cnt <= '0;
      if (bit_idx == 4'd9) begin
        busy <= 1'b0;             // 停止位发完
        tx   <= 1'b1;
      end else begin
        bit_idx <= bit_idx + 4'd1;
        tx      <= frame[bit_idx + 4'd1];
      end
    end else begin
      clk_cnt <= clk_cnt + 1'b1;
    end
  end
endmodule

module uart_rx #(
  parameter CLKS_PER_BIT = 16
) (
  input  logic       clk,
  input  logic       rst,
  input  logic       rx,
  output logic [7:0] data,
  output logic       valid,     // 收到一个字节时拉高一拍
  output logic       frame_err  // 停止位不为 1
);
  localparam CW = $clog2(CLKS_PER_BIT);

  typedef enum logic [1:0] {IDLE = 2'd0, START = 2'd1, DATA = 2'd2, STOP = 2'd3} state_t;

  state_t        state;
  logic          rx_s0, rx_s;     // 两级同步
  logic [CW-1:0] clk_cnt;
  logic [2:0]    bit_idx;
  logic [7:0]    shreg;

  always_ff @(posedge clk) begin
    if (rst) begin
      rx_s0 <= 1'b1;
      rx_s  <= 1'b1;
    end else begin
      rx_s0 <= rx;
      rx_s  <= rx_s0;
    end
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      state     <= IDLE;
      clk_cnt   <= '0;
      bit_idx   <= '0;
      shreg     <= '0;
      data      <= '0;
      valid     <= 1'b0;
      frame_err <= 1'b0;
    end else begin
      valid <= 1'b0;
      case (state)
        IDLE: begin
          clk_cnt <= '0;
          if (!rx_s) state <= START;            // 检测到下降沿
        end
        START: begin                             // 在起始位中点再确认一次
          if (clk_cnt == CW'(CLKS_PER_BIT / 2 - 1)) begin
            clk_cnt <= '0;
            bit_idx <= '0;
            if (!rx_s) state <= DATA;
            else       state <= IDLE;           // 毛刺，放弃
          end else begin
            clk_cnt <= clk_cnt + 1'b1;
          end
        end
        DATA: begin                              // 每隔一个位宽在数据位中点采样
          if (clk_cnt == CW'(CLKS_PER_BIT - 1)) begin
            clk_cnt <= '0;
            shreg   <= {rx_s, shreg[7:1]};      // LSB 先到
            if (bit_idx == 3'd7) state <= STOP;
            bit_idx <= bit_idx + 3'd1;
          end else begin
            clk_cnt <= clk_cnt + 1'b1;
          end
        end
        default: begin                           // STOP
          if (clk_cnt == CW'(CLKS_PER_BIT - 1)) begin
            clk_cnt   <= '0;
            data      <= shreg;
            valid     <= 1'b1;
            frame_err <= !rx_s;
            state     <= IDLE;
          end else begin
            clk_cnt <= clk_cnt + 1'b1;
          end
        end
      endcase
    end
  end
endmodule
