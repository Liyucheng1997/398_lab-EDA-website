`timescale 1ns / 1ps

// UART 发送器（8N1）：1 个起始位、8 个数据位（LSB 先发）、1 个停止位
module uart_tx #(
  parameter CLKS_PER_BIT = 104   // = 时钟频率 / 波特率，例如 12 MHz / 115200 ≈ 104
) (
  input  logic       clk,
  input  logic       rst,
  input  logic       start,      // 单拍启动（busy 为 0 时有效）
  input  logic [7:0] data,
  output logic       tx,         // 空闲为高
  output logic       busy
);
  localparam CW = (CLKS_PER_BIT > 1) ? $clog2(CLKS_PER_BIT) : 1;

  logic [CW-1:0] clk_cnt;
  logic [3:0]    bit_idx;        // 0 = 起始位，1~8 = 数据位，9 = 停止位
  logic [9:0]    frame;          // {停止位, 数据, 起始位}

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
        tx      <= 1'b0;         // 立即输出起始位
      end
    end else if (clk_cnt == CW'(CLKS_PER_BIT - 1)) begin
      clk_cnt <= '0;
      if (bit_idx == 4'd9) begin
        busy <= 1'b0;
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
