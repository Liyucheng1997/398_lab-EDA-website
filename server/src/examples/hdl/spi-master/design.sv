`timescale 1ns / 1ps

// SPI 主机（模式 0：CPOL = 0，CPHA = 0），8 位全双工传输，MSB 先发。
//   SCLK 频率 = clk / (2 × CLK_DIV)。
//   模式 0：SCLK 空闲为低；数据在 SCLK 上升沿被双方采样，在下降沿更新。
module spi_master #(
  parameter CLK_DIV = 4   // 半个 SCLK 周期包含的系统时钟数（≥ 1）
) (
  input  logic       clk,
  input  logic       rst,
  input  logic       start,     // 单拍启动一次 8 位传输（busy 为 0 时有效）
  input  logic [7:0] tx_data,
  output logic [7:0] rx_data,
  output logic       busy,
  output logic       done,      // 传输结束时拉高一拍，rx_data 有效
  // SPI 总线
  output logic       sclk,
  output logic       mosi,
  input  logic       miso,
  output logic       cs_n
);
  localparam CW = (CLK_DIV > 1) ? $clog2(CLK_DIV) : 1;

  logic [CW-1:0] div_cnt;
  logic [3:0]    edge_cnt;  // 每次传输 16 个 SCLK 边沿
  logic [7:0]    tx_sh, rx_sh;

  always_ff @(posedge clk) begin
    if (rst) begin
      busy     <= 1'b0;
      done     <= 1'b0;
      sclk     <= 1'b0;
      cs_n     <= 1'b1;
      mosi     <= 1'b0;
      div_cnt  <= '0;
      edge_cnt <= '0;
      tx_sh    <= '0;
      rx_sh    <= '0;
      rx_data  <= '0;
    end else begin
      done <= 1'b0;
      if (!busy) begin
        if (start) begin
          busy     <= 1'b1;
          cs_n     <= 1'b0;
          tx_sh    <= {tx_data[6:0], 1'b0};
          mosi     <= tx_data[7];   // CPHA = 0：第一个上升沿之前数据就要准备好
          div_cnt  <= '0;
          edge_cnt <= '0;
        end
      end else if (div_cnt == CW'(CLK_DIV - 1)) begin
        div_cnt  <= '0;
        sclk     <= ~sclk;
        edge_cnt <= edge_cnt + 4'd1;
        if (!sclk) begin
          // 上升沿：采样 MISO
          rx_sh <= {rx_sh[6:0], miso};
        end else begin
          // 下降沿：输出下一位；第 16 个边沿后结束
          if (edge_cnt == 4'd15) begin
            busy    <= 1'b0;
            done    <= 1'b1;
            cs_n    <= 1'b1;
            rx_data <= rx_sh;
          end else begin
            mosi  <= tx_sh[7];
            tx_sh <= {tx_sh[6:0], 1'b0};
          end
        end
      end else begin
        div_cnt <= div_cnt + 1'b1;
      end
    end
  end
endmodule
